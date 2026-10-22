use std::{
    fs, io,
    path::{Path, PathBuf},
};

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct WorkspaceAccessPreflight {
    pub permission_denied: bool,
}

/// Keep the post-login macOS privacy preflight deliberately narrow. Other
/// folders are handled only when the user explicitly chooses them in the
/// workspace picker; startup must never enumerate Desktop or Downloads.
pub(crate) fn startup_probe_paths(document_dir: Option<PathBuf>) -> Vec<PathBuf> {
    document_dir.into_iter().collect()
}

pub(crate) fn preflight_with_probe(
    paths: &[PathBuf],
    mut probe: impl FnMut(&Path) -> io::Result<()>,
) -> WorkspaceAccessPreflight {
    let mut result = WorkspaceAccessPreflight::default();
    for path in paths {
        if let Err(error) = probe(path) {
            // Continue after a denial so macOS still gets a chance to request
            // every other independent folder grant. Never return or log paths.
            if error.kind() == io::ErrorKind::PermissionDenied {
                result.permission_denied = true;
            }
        }
    }
    result
}

pub(crate) fn preflight(paths: &[PathBuf]) -> WorkspaceAccessPreflight {
    preflight_with_probe(paths, |path| {
        // Creating the iterator opens the directory. Advancing it once also
        // confirms that contents can be enumerated, which is the operation
        // protected by macOS Files and Folders privacy controls. No entry name
        // or file content leaves this function.
        let mut entries = fs::read_dir(path)?;
        let _ = entries.next().transpose()?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_requests_only_documents_access() {
        assert_eq!(
            startup_probe_paths(Some(PathBuf::from("/Users/relay/Documents"))),
            vec![PathBuf::from("/Users/relay/Documents")]
        );
    }

    #[test]
    fn missing_documents_path_does_not_fall_back_to_another_folder() {
        assert!(startup_probe_paths(None).is_empty());
    }

    #[test]
    fn one_denial_does_not_skip_later_permission_requests() {
        let paths = vec![
            PathBuf::from("/Users/relay/Documents"),
            PathBuf::from("/Users/relay/Other"),
        ];
        let mut visited = Vec::new();
        let result = preflight_with_probe(&paths, |path| {
            visited.push(path.to_path_buf());
            if path.ends_with("Documents") {
                Err(io::Error::from(io::ErrorKind::PermissionDenied))
            } else {
                Ok(())
            }
        });

        assert!(result.permission_denied);
        assert_eq!(visited, paths);
    }
}
