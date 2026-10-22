import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, "out");

async function htmlFiles(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

async function setDocumentLocale(directory, language, direction) {
  const files = await htmlFiles(directory);
  if (files.length === 0) {
    throw new Error(`No static HTML files found below ${directory}`);
  }

  for (const file of files) {
    const html = await readFile(file, "utf8");
    const languageAttributes = html.match(/<html\b[^>]*\blang="[^"]+"/g) ?? [];
    if (languageAttributes.length !== 1) {
      throw new Error(
        `Expected exactly one document language in ${file}; found ${languageAttributes.length}`,
      );
    }

    const serializedRootLanguage = String.raw`\"lang\":\"zh-CN`;
    const serializedLanguageCount =
      html.split(serializedRootLanguage).length - 1;
    const serializedTargetLanguage = String.raw`\"lang\":\"${language}`;
    const serializedTargetLanguageCount =
      html.split(serializedTargetLanguage).length - 1;
    if (
      serializedLanguageCount !== 1 &&
      !(serializedLanguageCount === 0 && serializedTargetLanguageCount > 0) &&
      !(language === "zh-CN" && serializedLanguageCount > 0)
    ) {
      throw new Error(
        `Could not identify the serialized root language in ${file}`,
      );
    }

    const directionAttributes = html.match(/<html\b[^>]*\bdir="[^"]+"/g) ?? [];
    if (directionAttributes.length !== 1) {
      throw new Error(
        `Expected exactly one document direction in ${file}; found ${directionAttributes.length}`,
      );
    }

    const serializedRootDirection = String.raw`\"dir\":\"ltr`;
    const serializedRootLocale = String.raw`\"lang\":\"zh-CN\",\"dir\":\"ltr`;
    const serializedDirectionCount =
      html.split(serializedRootDirection).length - 1;
    const serializedTargetDirection = String.raw`\"dir\":\"${direction}`;
    const serializedTargetDirectionCount =
      html.split(serializedTargetDirection).length - 1;
    if (
      serializedDirectionCount !== 1 &&
      !html.includes(serializedRootLocale) &&
      !(serializedDirectionCount === 0 && serializedTargetDirectionCount > 0) &&
      !(direction === "ltr" && serializedDirectionCount > 0)
    ) {
      throw new Error(
        `Could not identify the serialized root direction in ${file}`,
      );
    }

    const updated = html.replace(
      /(<html\b[^>]*\blang=")[^"]+("[^>]*>)/,
      `$1${language}$2`,
    ).replace(
      /(<html\b[^>]*\bdir=")[^"]+("[^>]*>)/,
      `$1${direction}$2`,
    ).replace(
      serializedRootLanguage,
      String.raw`\"lang\":\"${language}`,
    ).replace(
      serializedRootDirection,
      String.raw`\"dir\":\"${direction}`,
    );
    if (
      !updated.startsWith(
        `<!DOCTYPE html><html lang="${language}" dir="${direction}"`,
      )
    ) {
      throw new Error(`Could not verify document locale ${language}/${direction} in ${file}`);
    }
    if (language !== "zh-CN" && updated.includes(serializedRootLanguage)) {
      throw new Error(`Serialized root language remained incorrect in ${file}`);
    }
    const serializedIncorrectRootDirection = String.raw`\"lang\":\"${language}\",\"dir\":\"ltr`;
    if (direction !== "ltr" && updated.includes(serializedIncorrectRootDirection)) {
      throw new Error(`Serialized root direction remained incorrect in ${file}`);
    }
    await writeFile(file, updated);
  }
}

const staticLocales = [
  ["en", "en", "ltr"],
  ["zh", "zh-CN", "ltr"],
  ["hi", "hi", "ltr"],
  ["es", "es", "ltr"],
  ["ar", "ar", "rtl"],
  ["fr", "fr", "ltr"],
  ["bn", "bn", "ltr"],
  ["pt", "pt", "ltr"],
  ["id", "id", "ltr"],
  ["ur", "ur", "rtl"],
];

for (const [directory, language, direction] of staticLocales) {
  await setDocumentLocale(
    path.join(outputDirectory, directory),
    language,
    direction,
  );
}
