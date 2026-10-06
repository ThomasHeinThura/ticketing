import { getCustomProviderIdToken } from "../repository";

async function getIdToken(userId: string) {
  const [account] = await getCustomProviderIdToken(userId);

  return { idToken: account?.idToken ?? null };
}

export default getIdToken;
