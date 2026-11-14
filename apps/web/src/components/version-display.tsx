export function VersionDisplay() {
  const version = __APP_VERSION__;
  const changelogUrl =
    "https://github.com/usetaskdesk/taskdesk/blob/main/CHANGELOG.md";

  return (
    <div className="flex items-center justify-center px-2 py-1.5">
      <a
        href={changelogUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-base"
      >
        v{version}
      </a>
    </div>
  );
}
