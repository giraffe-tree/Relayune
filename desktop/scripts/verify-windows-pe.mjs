import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const IMAGE_FILE_MACHINE_AMD64 = 0x8664;
const IMAGE_FILE_MACHINE_ARM64 = 0xaa64;
const PE32_PLUS_MAGIC = 0x20b;
const WINDOWS_GUI_SUBSYSTEM = 2;
const WINDOWS_CUI_SUBSYSTEM = 3;
const IMAGE_FILE_EXECUTABLE_IMAGE = 0x0002;
const IMAGE_FILE_DLL = 0x2000;
const IMAGE_SCN_MEM_EXECUTE = 0x20000000;
const HIGH_ENTROPY_VA = 0x20;
const DYNAMIC_BASE = 0x40;
const NX_COMPAT = 0x100;
const IMPORT_DIRECTORY_INDEX = 1;
const RESOURCE_DIRECTORY_INDEX = 2;
const DELAY_IMPORT_DIRECTORY_INDEX = 13;
const RT_MANIFEST = 24;
const DIRECTORY_BIT = 0x80000000;
const VC_REDISTRIBUTABLE_DLL =
  /^(?:(?:vcruntime|msvcp|msvcr|concrt|vcomp|vccorlib)\d+[a-z]*(?:_[a-z0-9]+)*|(?:atl|mfc|mfcm)\d+[a-z]*)\.dll$/i;
const WINDOWS_API_SET_DLL = /^api-ms-win-[a-z0-9-]+\.dll$/i;
const WINDOWS_SYSTEM_DLLS = new Set([
  "advapi32.dll",
  "bcrypt.dll",
  "bcryptprimitives.dll",
  "comctl32.dll",
  "crypt32.dll",
  "dbghelp.dll",
  "dwmapi.dll",
  "gdi32.dll",
  "iphlpapi.dll",
  "kernel32.dll",
  "kernelbase.dll",
  "msvcrt.dll",
  "ntdll.dll",
  "ole32.dll",
  "oleaut32.dll",
  "shell32.dll",
  "shlwapi.dll",
  "ucrtbase.dll",
  "user32.dll",
  "userenv.dll",
  "winmm.dll",
  "ws2_32.dll",
]);
const ELEVATED_EXECUTION_LEVEL =
  /<requestedExecutionLevel\b[^>]*\blevel\s*=\s*["'](?:requireAdministrator|highestAvailable)["']/i;
const ENABLED_UI_ACCESS = /<requestedExecutionLevel\b[^>]*\buiAccess\s*=\s*["']true["']/i;
const COMMON_CONTROLS_ASSEMBLY_IDENTITY =
  /<assemblyIdentity\b(?=[^>]*\bname\s*=\s*["']Microsoft\.Windows\.Common-Controls["'])[^>]*>/i;
const WINDOWS_MACHINES = new Map([
  [IMAGE_FILE_MACHINE_AMD64, { label: "x64", target: "x86_64-pc-windows-msvc" }],
  [IMAGE_FILE_MACHINE_ARM64, { label: "arm64", target: "aarch64-pc-windows-msvc" }],
]);

function requireRange(buffer, offset, length, label) {
  assert.ok(
    Number.isSafeInteger(offset) &&
      Number.isSafeInteger(length) &&
      offset >= 0 &&
      length >= 0 &&
      offset + length <= buffer.length,
    `${label} is outside the PE file`,
  );
}

function isPowerOfTwo(value) {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

function readCString(buffer, offset, available, label) {
  const limit = Math.min(available, 4096);
  requireRange(buffer, offset, limit, label);
  const terminator = buffer.indexOf(0, offset);
  assert.ok(
    terminator >= offset && terminator < offset + limit,
    `${label} is not null-terminated inside its PE section`,
  );
  const value = buffer.toString("ascii", offset, terminator);
  assert.match(value, /^[\x20-\x7e]+$/, `${label} is not printable ASCII`);
  return value;
}

function decodeManifest(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }
  const sampleLength = Math.min(buffer.length, 64);
  let oddNulls = 0;
  for (let index = 1; index < sampleLength; index += 2) {
    if (buffer[index] === 0) oddNulls += 1;
  }
  if (sampleLength >= 8 && oddNulls >= Math.floor(sampleLength / 8)) {
    return buffer.toString("utf16le");
  }
  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

function stripManifestComments(manifest) {
  let cursor = 0;
  let activeXml = "";
  while (cursor < manifest.length) {
    const commentStart = manifest.indexOf("<!--", cursor);
    const strayEnd = manifest.indexOf("-->", cursor);
    assert.ok(
      strayEnd === -1 || (commentStart !== -1 && commentStart < strayEnd),
      "RT_MANIFEST contains an unmatched XML comment terminator",
    );
    if (commentStart === -1) {
      activeXml += manifest.slice(cursor);
      break;
    }
    activeXml += manifest.slice(cursor, commentStart);
    const commentEnd = manifest.indexOf("-->", commentStart + 4);
    assert.notEqual(commentEnd, -1, "RT_MANIFEST contains an unterminated XML comment");
    assert.equal(
      manifest.slice(commentStart + 4, commentEnd).includes("--"),
      false,
      "RT_MANIFEST contains an invalid XML comment",
    );
    cursor = commentEnd + 3;
  }
  return activeXml;
}

function parsePeHeaders(buffer) {
  assert.ok(Buffer.isBuffer(buffer), "PE input must be a Buffer");
  requireRange(buffer, 0, 0x40, "DOS header");
  assert.equal(buffer.toString("ascii", 0, 2), "MZ", "missing DOS MZ signature");

  const peOffset = buffer.readUInt32LE(0x3c);
  requireRange(buffer, peOffset, 24, "PE header");
  assert.equal(buffer.toString("binary", peOffset, peOffset + 4), "PE\0\0", "missing PE signature");

  const coffOffset = peOffset + 4;
  const numberOfSections = buffer.readUInt16LE(coffOffset + 2);
  const optionalHeaderSize = buffer.readUInt16LE(coffOffset + 16);
  const optionalOffset = coffOffset + 20;
  requireRange(buffer, optionalOffset, optionalHeaderSize, "optional header");
  assert.ok(optionalHeaderSize >= 136, "PE32+ optional header is truncated");
  assert.ok(numberOfSections > 0 && numberOfSections <= 96, "invalid PE section count");

  const numberOfDataDirectories = buffer.readUInt32LE(optionalOffset + 108);
  assert.ok(
    numberOfDataDirectories > RESOURCE_DIRECTORY_INDEX,
    "PE does not declare import and resource directories",
  );
  assert.ok(numberOfDataDirectories <= 16, "PE declares more than 16 standard data directories");
  assert.ok(
    112 + numberOfDataDirectories * 8 <= optionalHeaderSize,
    "PE data directories exceed the declared optional header",
  );
  const sizeOfHeaders = buffer.readUInt32LE(optionalOffset + 60);
  assert.ok(sizeOfHeaders > 0 && sizeOfHeaders <= buffer.length, "invalid PE header size");
  const sectionAlignment = buffer.readUInt32LE(optionalOffset + 32);
  const fileAlignment = buffer.readUInt32LE(optionalOffset + 36);
  const sizeOfImage = buffer.readUInt32LE(optionalOffset + 56);
  assert.ok(
    isPowerOfTwo(fileAlignment) && fileAlignment >= 0x200 && fileAlignment <= 0x10000,
    "PE FileAlignment must be a power of two between 512 and 65536 bytes",
  );
  assert.ok(
    isPowerOfTwo(sectionAlignment) && sectionAlignment >= fileAlignment,
    "PE SectionAlignment must be a power of two no smaller than FileAlignment",
  );
  assert.equal(sizeOfHeaders % fileAlignment, 0, "PE SizeOfHeaders is not FileAlignment-aligned");
  assert.ok(sizeOfImage > 0, "PE SizeOfImage must be nonzero");
  assert.equal(sizeOfImage % sectionAlignment, 0, "PE SizeOfImage is not SectionAlignment-aligned");
  const addressOfEntryPoint = buffer.readUInt32LE(optionalOffset + 16);

  const sectionTableOffset = optionalOffset + optionalHeaderSize;
  requireRange(buffer, sectionTableOffset, numberOfSections * 40, "section table");
  assert.ok(
    sectionTableOffset + numberOfSections * 40 <= sizeOfHeaders,
    "PE SizeOfHeaders does not cover the section table",
  );
  const sections = [];
  for (let index = 0; index < numberOfSections; index += 1) {
    const offset = sectionTableOffset + index * 40;
    const rawName = buffer.subarray(offset, offset + 8);
    const zero = rawName.indexOf(0);
    const name = rawName.toString("ascii", 0, zero === -1 ? rawName.length : zero);
    const section = {
      name,
      virtualSize: buffer.readUInt32LE(offset + 8),
      virtualAddress: buffer.readUInt32LE(offset + 12),
      rawSize: buffer.readUInt32LE(offset + 16),
      rawOffset: buffer.readUInt32LE(offset + 20),
      characteristics: buffer.readUInt32LE(offset + 36),
    };
    if (section.rawSize > 0) {
      assert.equal(
        section.rawOffset % fileAlignment,
        0,
        `section ${name || index} raw offset is not FileAlignment-aligned`,
      );
      assert.equal(
        section.rawSize % fileAlignment,
        0,
        `section ${name || index} raw size is not FileAlignment-aligned`,
      );
      requireRange(buffer, section.rawOffset, section.rawSize, `section ${name || index}`);
    }
    assert.equal(
      section.virtualAddress % sectionAlignment,
      0,
      `section ${name || index} virtual address is not SectionAlignment-aligned`,
    );
    assert.ok(
      section.virtualAddress + Math.max(section.virtualSize, section.rawSize) <= sizeOfImage,
      `section ${name || index} exceeds PE SizeOfImage`,
    );
    sections.push(section);
  }

  function locateRva(rva, label) {
    assert.ok(Number.isSafeInteger(rva) && rva >= 0, `${label} has an invalid RVA`);
    if (rva < sizeOfHeaders) {
      requireRange(buffer, rva, 1, label);
      return { offset: rva, available: sizeOfHeaders - rva, sectionCharacteristics: 0 };
    }
    for (const section of sections) {
      const span = Math.max(section.virtualSize, section.rawSize);
      if (rva < section.virtualAddress || rva >= section.virtualAddress + span) continue;
      const delta = rva - section.virtualAddress;
      assert.ok(delta < section.rawSize, `${label} points into virtual-only section data`);
      return {
        offset: section.rawOffset + delta,
        available: section.rawSize - delta,
        sectionCharacteristics: section.characteristics,
      };
    }
    assert.fail(`${label} does not map to any PE section`);
  }

  function directory(index, label) {
    if (index >= numberOfDataDirectories) return { rva: 0, size: 0 };
    const offset = optionalOffset + 112 + index * 8;
    requireRange(buffer, offset, 8, `${label} directory entry`);
    const rva = buffer.readUInt32LE(offset);
    const size = buffer.readUInt32LE(offset + 4);
    assert.equal(rva === 0, size === 0, `${label} directory has an incomplete RVA/size pair`);
    if (size > 0) {
      const location = locateRva(rva, `${label} directory`);
      assert.ok(size <= location.available, `${label} directory crosses its PE section`);
    }
    return { rva, size };
  }

  return {
    machine: buffer.readUInt16LE(coffOffset),
    characteristics: buffer.readUInt16LE(coffOffset + 18),
    magic: buffer.readUInt16LE(optionalOffset),
    subsystem: buffer.readUInt16LE(optionalOffset + 68),
    dllCharacteristics: buffer.readUInt16LE(optionalOffset + 70),
    numberOfSections,
    sectionAlignment,
    fileAlignment,
    sizeOfImage,
    addressOfEntryPoint,
    locateRva,
    importDirectory: directory(IMPORT_DIRECTORY_INDEX, "import"),
    resourceDirectory: directory(RESOURCE_DIRECTORY_INDEX, "resource"),
    delayImportDirectory: directory(DELAY_IMPORT_DIRECTORY_INDEX, "delay import"),
  };
}

function parseImportNames(buffer, headers) {
  const { rva, size } = headers.importDirectory;
  if (size === 0) return [];
  const directory = headers.locateRva(rva, "import directory");
  const descriptorCount = Math.floor(size / 20);
  assert.ok(descriptorCount > 0 && descriptorCount <= 4096, "invalid import descriptor count");
  const names = [];
  let terminated = false;
  for (let index = 0; index < descriptorCount; index += 1) {
    const offset = directory.offset + index * 20;
    requireRange(buffer, offset, 20, `import descriptor ${index}`);
    const fields = Array.from({ length: 5 }, (_, field) => buffer.readUInt32LE(offset + field * 4));
    if (fields.every((field) => field === 0)) {
      terminated = true;
      break;
    }
    const nameRva = fields[3];
    assert.ok(nameRva > 0, `import descriptor ${index} has no DLL name RVA`);
    const nameLocation = headers.locateRva(nameRva, `import descriptor ${index} DLL name`);
    names.push(
      readCString(
        buffer,
        nameLocation.offset,
        nameLocation.available,
        `import descriptor ${index} DLL name`,
      ).toLowerCase(),
    );
  }
  assert.equal(terminated, true, "import descriptor table is not terminated inside its directory");
  return names;
}

function parseDelayImportNames(buffer, headers) {
  const { rva, size } = headers.delayImportDirectory;
  if (size === 0) return [];
  const directory = headers.locateRva(rva, "delay import directory");
  const descriptorSize = 32;
  const descriptorCount = Math.floor(size / descriptorSize);
  assert.ok(
    descriptorCount > 0 && descriptorCount <= 4096,
    "invalid delay import descriptor count",
  );
  const names = [];
  let terminated = false;
  for (let index = 0; index < descriptorCount; index += 1) {
    const offset = directory.offset + index * descriptorSize;
    requireRange(buffer, offset, descriptorSize, `delay import descriptor ${index}`);
    const fields = Array.from({ length: 8 }, (_, field) =>
      buffer.readUInt32LE(offset + field * 4),
    );
    if (fields.every((field) => field === 0)) {
      terminated = true;
      break;
    }
    const attributes = fields[0];
    assert.equal(
      attributes,
      1,
      `delay import descriptor ${index} must encode its fields as RVAs`,
    );
    const nameRva = fields[1];
    assert.ok(nameRva > 0, `delay import descriptor ${index} has no DLL name RVA`);
    const nameLocation = headers.locateRva(
      nameRva,
      `delay import descriptor ${index} DLL name`,
    );
    names.push(
      readCString(
        buffer,
        nameLocation.offset,
        nameLocation.available,
        `delay import descriptor ${index} DLL name`,
      ).toLowerCase(),
    );
  }
  assert.equal(
    terminated,
    true,
    "delay import descriptor table is not terminated inside its directory",
  );
  return names;
}

function parseManifestTexts(buffer, headers) {
  const { rva, size } = headers.resourceDirectory;
  if (size === 0) return [];
  const root = headers.locateRva(rva, "resource directory");

  function relativeRange(relativeOffset, length, label) {
    assert.ok(
      Number.isSafeInteger(relativeOffset) &&
        relativeOffset >= 0 &&
        relativeOffset + length <= size,
      `${label} is outside the resource directory`,
    );
    const offset = root.offset + relativeOffset;
    requireRange(buffer, offset, length, label);
    return offset;
  }

  function entriesAt(relativeOffset, label) {
    const offset = relativeRange(relativeOffset, 16, `${label} header`);
    const count = buffer.readUInt16LE(offset + 12) + buffer.readUInt16LE(offset + 14);
    assert.ok(count <= 4096, `${label} has too many entries`);
    relativeRange(relativeOffset + 16, count * 8, `${label} entries`);
    return Array.from({ length: count }, (_, index) => {
      const entryOffset = offset + 16 + index * 8;
      return {
        name: buffer.readUInt32LE(entryOffset),
        data: buffer.readUInt32LE(entryOffset + 4),
      };
    });
  }

  const manifestType = entriesAt(0, "resource root").find(
    (entry) => (entry.name & DIRECTORY_BIT) === 0 && (entry.name & 0xffff) === RT_MANIFEST,
  );
  if (!manifestType) return [];
  assert.ok((manifestType.data & DIRECTORY_BIT) !== 0, "RT_MANIFEST does not point to a directory");

  const manifests = [];
  const visitedDirectories = new Set();
  function collect(relativeOffset, depth) {
    assert.ok(depth <= 4, "RT_MANIFEST resource tree is too deep");
    assert.equal(
      visitedDirectories.has(relativeOffset),
      false,
      "RT_MANIFEST resource tree contains a directory cycle",
    );
    visitedDirectories.add(relativeOffset);
    for (const entry of entriesAt(relativeOffset, "RT_MANIFEST directory")) {
      if ((entry.data & DIRECTORY_BIT) !== 0) {
        collect(entry.data & ~DIRECTORY_BIT, depth + 1);
        continue;
      }
      const dataEntryOffset = relativeRange(entry.data, 16, "RT_MANIFEST data entry");
      const dataRva = buffer.readUInt32LE(dataEntryOffset);
      const dataSize = buffer.readUInt32LE(dataEntryOffset + 4);
      assert.ok(dataSize > 0, "RT_MANIFEST data entry is empty");
      const data = headers.locateRva(dataRva, "RT_MANIFEST data");
      assert.ok(dataSize <= data.available, "RT_MANIFEST data crosses its PE section");
      manifests.push(decodeManifest(buffer.subarray(data.offset, data.offset + dataSize)));
    }
  }
  collect(manifestType.data & ~DIRECTORY_BIT, 1);
  return manifests;
}

export function inspectWindowsPe(buffer) {
  const headers = parsePeHeaders(buffer);
  const entryPoint =
    headers.addressOfEntryPoint === 0
      ? null
      : headers.locateRva(headers.addressOfEntryPoint, "entry point");
  const importNames = parseImportNames(buffer, headers);
  const delayImportNames = parseDelayImportNames(buffer, headers);
  const manifestTexts = parseManifestTexts(buffer, headers);
  const activeManifestTexts = manifestTexts.map(stripManifestComments);
  return {
    machine: headers.machine,
    characteristics: headers.characteristics,
    magic: headers.magic,
    subsystem: headers.subsystem,
    dllCharacteristics: headers.dllCharacteristics,
    numberOfSections: headers.numberOfSections,
    addressOfEntryPoint: headers.addressOfEntryPoint,
    entryPointSectionCharacteristics: entryPoint?.sectionCharacteristics ?? 0,
    resourceRva: headers.resourceDirectory.rva,
    resourceSize: headers.resourceDirectory.size,
    importNames,
    delayImportNames,
    manifestCount: manifestTexts.length,
    dynamicVcRuntimeImports: [...importNames, ...delayImportNames].filter((name) =>
      VC_REDISTRIBUTABLE_DLL.test(name),
    ),
    unexpectedRuntimeImports: [...importNames, ...delayImportNames].filter((name) => {
      const normalized = name.toLowerCase();
      return !WINDOWS_API_SET_DLL.test(normalized) && !WINDOWS_SYSTEM_DLLS.has(normalized);
    }),
    hasCommonControlsManifest: activeManifestTexts.some((manifest) =>
      COMMON_CONTROLS_ASSEMBLY_IDENTITY.test(manifest),
    ),
    requiresElevation: activeManifestTexts.some((manifest) =>
      ELEVATED_EXECUTION_LEVEL.test(manifest),
    ),
    requestsUiAccess: activeManifestTexts.some((manifest) => ENABLED_UI_ACCESS.test(manifest)),
  };
}

function verifySharedContracts(metadata, label, expectedMachine) {
  assert.equal(
    metadata.machine,
    expectedMachine,
    `${label} must be a ${WINDOWS_MACHINES.get(expectedMachine).label} PE`,
  );
  assert.equal(metadata.magic, PE32_PLUS_MAGIC, `${label} must be PE32+`);
  assert.equal(
    metadata.characteristics & IMAGE_FILE_EXECUTABLE_IMAGE,
    IMAGE_FILE_EXECUTABLE_IMAGE,
    `${label} COFF header must mark an executable image`,
  );
  assert.equal(
    metadata.characteristics & IMAGE_FILE_DLL,
    0,
    `${label} COFF header must not mark the payload as a DLL`,
  );
  assert.ok(metadata.addressOfEntryPoint > 0, `${label} must declare a nonzero entry point`);
  assert.equal(
    metadata.entryPointSectionCharacteristics & IMAGE_SCN_MEM_EXECUTE,
    IMAGE_SCN_MEM_EXECUTE,
    `${label} entry point must map to an executable PE section`,
  );
  assert.ok(metadata.numberOfSections > 0, `${label} must contain mapped PE sections`);
  assert.ok(metadata.importNames.length > 0, `${label} must contain a parsed import table`);
  assert.ok(metadata.resourceRva > 0 && metadata.resourceSize > 0, `${label} must contain resources`);
  assert.equal(
    metadata.dllCharacteristics & (HIGH_ENTROPY_VA | DYNAMIC_BASE | NX_COMPAT),
    HIGH_ENTROPY_VA | DYNAMIC_BASE | NX_COMPAT,
    `${label} must enable ASLR, high-entropy ASLR, and DEP`,
  );
  assert.deepEqual(
    metadata.dynamicVcRuntimeImports,
    [],
    `${label} must not require VC Redistributable DLLs`,
  );
  assert.deepEqual(
    metadata.unexpectedRuntimeImports,
    [],
    `${label} must not import unpackaged non-system DLLs`,
  );
  assert.equal(
    metadata.requiresElevation,
    false,
    `${label} must not request administrator or highest-available execution`,
  );
  assert.equal(
    metadata.requestsUiAccess,
    false,
    `${label} must not request UIAccess from the current-user install directory`,
  );
}

export function verifyWindowsPePair(guiBuffer, sidecarBuffer, options = {}) {
  const gui = inspectWindowsPe(guiBuffer);
  const sidecar = inspectWindowsPe(sidecarBuffer);
  const expectedMachine = options.expectedMachine ?? gui.machine;
  assert.ok(WINDOWS_MACHINES.has(expectedMachine), "unsupported Windows PE machine");
  verifySharedContracts(gui, "Relayune GUI", expectedMachine);
  verifySharedContracts(sidecar, "Relayune sidecar", expectedMachine);
  assert.equal(gui.subsystem, WINDOWS_GUI_SUBSYSTEM, "release GUI must not allocate a console");
  assert.equal(sidecar.subsystem, WINDOWS_CUI_SUBSYSTEM, "sidecar must remain a console executable");
  assert.ok(gui.manifestCount > 0, "GUI must contain an RT_MANIFEST resource");
  assert.equal(gui.hasCommonControlsManifest, true, "GUI manifest must enable Common Controls");
  return { gui, sidecar };
}

export function assertArtifactBuiltAfter(artifactMtimeMs, minimumMtimeMs, label) {
  assert.ok(Number.isFinite(artifactMtimeMs), `${label} has no finite modification time`);
  assert.ok(Number.isFinite(minimumMtimeMs), "build marker has no finite modification time");
  assert.ok(
    artifactMtimeMs >= minimumMtimeMs,
    `${label} predates the current Windows build marker`,
  );
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function optionalArgumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  assert.ok(process.argv[index + 1], `missing value for ${name}`);
  return process.argv[index + 1];
}

async function main() {
  const guiPath = optionalArgumentValue("--gui");
  assert.ok(guiPath, "missing --gui");
  const explicitSidecarPath = optionalArgumentValue("--sidecar");
  const sidecarDirectory = optionalArgumentValue("--sidecar-directory");
  assert.notEqual(
    Boolean(explicitSidecarPath),
    Boolean(sidecarDirectory),
    "provide exactly one of --sidecar or --sidecar-directory",
  );
  const guiBuffer = await readFile(guiPath);
  const guiMachine = inspectWindowsPe(guiBuffer).machine;
  const machine = WINDOWS_MACHINES.get(guiMachine);
  assert.ok(machine, "GUI uses an unsupported Windows PE machine");
  const sidecarPath =
    explicitSidecarPath ?? join(sidecarDirectory, `relayune-core-${machine.target}.exe`);
  const expectedMachineName = optionalArgumentValue("--expected-machine");
  const expectedMachine = expectedMachineName
    ? [...WINDOWS_MACHINES].find(([, value]) => value.label === expectedMachineName)?.[0]
    : guiMachine;
  assert.ok(expectedMachine, `unsupported --expected-machine ${expectedMachineName}`);
  const sidecarBuffer = await readFile(sidecarPath);
  const minimumMtimeFile = optionalArgumentValue("--minimum-mtime-file");
  let freshnessSummary = "";
  if (minimumMtimeFile) {
    const [markerStats, guiStats, sidecarStats] = await Promise.all([
      stat(minimumMtimeFile),
      stat(guiPath),
      stat(sidecarPath),
    ]);
    assert.equal(markerStats.isFile(), true, "Windows build marker must be a file");
    assert.equal(guiStats.isFile(), true, "Relayune GUI must be a file");
    assert.equal(sidecarStats.isFile(), true, "Relayune sidecar must be a file");
    assertArtifactBuiltAfter(guiStats.mtimeMs, markerStats.mtimeMs, "Relayune GUI");
    assertArtifactBuiltAfter(sidecarStats.mtimeMs, markerStats.mtimeMs, "Relayune sidecar");
    freshnessSummary = ` Both artifacts are newer than build marker ${markerStats.mtime.toISOString()}.`;
  }
  const { gui, sidecar } = verifyWindowsPePair(guiBuffer, sidecarBuffer, { expectedMachine });
  console.log(
      `Verified ${WINDOWS_MACHINES.get(gui.machine).label} PE contracts: GUI subsystem ${gui.subsystem}, sidecar subsystem ${sidecar.subsystem}, loader-aligned image layouts and executable entry points, audited system-only normal/delay imports and non-elevating RT_MANIFEST resources, static VC runtime, ASLR, and DEP.${freshnessSummary} GUI SHA-256 ${sha256(guiBuffer)}; sidecar SHA-256 ${sha256(sidecarBuffer)}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
