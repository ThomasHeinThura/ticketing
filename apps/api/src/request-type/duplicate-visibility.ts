export function mayExposeDuplicateSuggestions(input: {
  hasUser: boolean;
  hasApiKey: boolean;
  hasWorkItemRead: boolean;
}) {
  return input.hasUser && !input.hasApiKey && input.hasWorkItemRead;
}
