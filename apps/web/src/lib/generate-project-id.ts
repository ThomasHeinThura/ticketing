function generateProjectSlug(projectName: string) {
  return projectName
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 15);
}

export default generateProjectSlug;
