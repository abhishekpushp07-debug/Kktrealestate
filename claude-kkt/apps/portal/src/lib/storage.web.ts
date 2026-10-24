// Storage abstraction (web): refresh token in localStorage (per API-CONVENTIONS Appendix A),
// everything else in AsyncStorage's web shim. Same surface as storage.ts.
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
