export interface PackageDescriptor { packagePath: string; name?: string; version?: string }
export interface PackageCoverage {
  name: string; version: string; package_path: string; package_json_sha256: string;
  source: { lockfile: string; lock_key: string; integrity: string | null; url: string | null };
  license_declaration: string | null;
  license_evidence_status?: string;
  license_files: Array<{ path: string; sha256: string; section?: string; file_sha256?: string; supplemental?: boolean; source_url?: string; evidence_kind?: string;
    publisher_declaration?: { path: string; sha256: string; source_url: string } }>;
}
export interface NoticeResult {
  text: string;
  coverage: { schema_version: number; selection: string; exact_bundle: boolean;
    packages: PackageCoverage[]; excluded: string[]; notices_sha256: string;
    emitted_input_count?: number; scope_note?: string; notices_complete: boolean; risk_accepted: false;
    unresolved: Array<{name: string; version: string; package_path: string; reason: string; risk_accepted: false}> };
}
export type SupplementalLicenseFiles = Record<string, Array<{ path: string; sha256: string; source_url: string; kind?: 'upstream-license' | 'standard-license-terms';
  publisher_declaration?: { path: string; sha256: string; source_url: string } }>>;
export function collectPackageNotices(options: { projectRoot: string; packages: Array<string | PackageDescriptor>; selection?: string; supplementalLicenseFiles?: SupplementalLicenseFiles }): Promise<NoticeResult>;
export function collectBundleNotices(options: { projectRoot: string; workingDirectory?: string;
  metafile?: { inputs: Record<string, unknown>; outputs: Record<string, { inputs?: Record<string, { bytesInOutput: number }> }> };
  moduleIds?: string[]; supplementalLicenseFiles?: SupplementalLicenseFiles }): Promise<NoticeResult>;
export function collectWebRuntimeNotices(options: { projectRoot: string; additionalDependencies?: string[]; supplementalLicenseFiles?: SupplementalLicenseFiles;
  excludeVerifiedWebArtifacts?: boolean;
  knownUnresolvedLicenses?: Record<string, { packagePath: string; packageJsonSha256: string; reason: string }> }): Promise<NoticeResult>;
