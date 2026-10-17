import { findCustomAccountIdToken } from "../repository";

async function getIdToken(userId: string) {
  const account = await findCustomAccountIdToken(userId);

  return { idToken: account?.idToken ?? null };
}

export default getIdToken;
