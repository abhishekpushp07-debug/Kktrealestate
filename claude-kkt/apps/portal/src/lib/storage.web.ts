// Storage abstraction (web). The refresh token is NOT kept here: on web it is the HttpOnly kkt_prt cookie (contract C1,
// src/api/session.ts); `secureStorage` only holds the "signed in on this browser" hint and deletes the legacy token key.
// Everything else goes through AsyncStorage's web shim. Same surface as storage.ts.
import AsyncStorage from "@react-native-async-storage/async-storage";

function local(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const secureStorage = {
  async get(key: string): Promise<string | null> {
    try {
      return local()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      local()?.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  async remove(key: string): Promise<void> {
    try {
      local()?.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export const kvStorage = {
  async get(key: string): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  async remove(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
