import { findCustomProviderIdToken } from "../repository";

async function getIdToken(userId: string) {
  return { idToken: await findCustomProviderIdToken(userId) };
}

export default getIdToken;
