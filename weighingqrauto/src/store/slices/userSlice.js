import {createSlice, createAsyncThunk} from '@reduxjs/toolkit';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {apiFetch, ApiError} from '../../services/apiClient';

const asErrorPayload = err => ({
  type: err instanceof ApiError ? err.type : 'network',
  message: err?.message || 'Connection failed.',
});

// ── Thunks ────────────────────────────────────────

export const loginThunk = createAsyncThunk(
  'user/login',
  async ({email, password, isAdmin}, {rejectWithValue}) => {
    const cleanEmail = (email || '').trim();
    try {
      if (isAdmin) {
        const data = await apiFetch('/api/auth/login', {
          method: 'POST',
          body: {email: cleanEmail, password},
        });
        const user = {
          ...data.admin,
          id: data.admin.id || data.admin._id,
          role: data.admin.role || 'admin',
          isAdmin: true,
        };
        await AsyncStorage.setItem('@session_user', JSON.stringify(user));
        await AsyncStorage.setItem('@session_token', data.token);
        return {user, token: data.token};
      }

      // Default: try operator login first
      try {
        const data = await apiFetch('/api/user/login', {
          method: 'POST',
          body: {email: cleanEmail, password},
        });
        await AsyncStorage.setItem('@session_user', JSON.stringify(data.user));
        await AsyncStorage.setItem('@session_token', data.token);
        return {user: data.user, token: data.token};
      } catch (err) {
        // If operator login failed with 401, auto-try admin login
        if (err?.status === 401 || err?.type === 'auth') {
          try {
            const adminData = await apiFetch('/api/auth/login', {
              method: 'POST',
              body: {email: cleanEmail, password},
            });
            const user = {
              ...adminData.admin,
              id: adminData.admin.id || adminData.admin._id,
              role: adminData.admin.role || 'admin',
              isAdmin: true,
            };
            await AsyncStorage.setItem('@session_user', JSON.stringify(user));
            await AsyncStorage.setItem('@session_token', adminData.token);
            return {user, token: adminData.token};
          } catch (_) {
            // Re-throw original error
          }
        }
        throw err;
      }
    } catch (err) {
      return rejectWithValue(asErrorPayload(err));
    }
  },
);

export const registerThunk = createAsyncThunk(
  'user/register',
  async ({name, email, password}, {rejectWithValue}) => {
    try {
      const data = await apiFetch('/api/user/register', {
        method: 'POST',
        body: {name, email, password},
      });
      return {user: data.user};
    } catch (err) {
      return rejectWithValue(asErrorPayload(err));
    }
  },
);

export const loadSessionThunk = createAsyncThunk(
  'user/loadSession',
  async (_, {rejectWithValue}) => {
    try {
      const userStr = await AsyncStorage.getItem('@session_user');
      const token = await AsyncStorage.getItem('@session_token');
      if (userStr && token) {
        return {user: JSON.parse(userStr), token};
      }
      return null;
    } catch {
      return rejectWithValue(null);
    }
  },
);

// Confirms the stored JWT is still valid against protectUser (GET
// /api/user/me). Non-fatal on failure — session stays intact so a
// momentary network blip on app open doesn't sign the user out.
export const fetchMeThunk = createAsyncThunk(
  'user/fetchMe',
  async (_, {getState, rejectWithValue}) => {
    try {
      const {token, user} = getState().user;
      if (!token) return null;
      if (user?.isAdmin || user?.role === 'admin' || user?.role === 'superadmin') {
        const data = await apiFetch('/api/auth/me', {method: 'GET', token});
        return {
          ...data.admin,
          id: data.admin.id || data.admin._id,
          role: data.admin.role || 'admin',
          isAdmin: true,
        };
      }
      const data = await apiFetch('/api/user/me', {method: 'GET', token});
      return data.user;
    } catch (err) {
      return rejectWithValue(asErrorPayload(err));
    }
  },
);

export const logoutThunk = createAsyncThunk('user/logout', async () => {
  await AsyncStorage.removeItem('@session_user');
  await AsyncStorage.removeItem('@session_token');
});

export const updateProfileThunk = createAsyncThunk(
  'user/updateProfile',
  async ({name, email, token}, {rejectWithValue}) => {
    try {
      const data = await apiFetch('/api/user/me', {
        method: 'PUT',
        token,
        body: {name, email},
      });
      await AsyncStorage.setItem('@session_user', JSON.stringify(data.user));
      return data.user;
    } catch (err) {
      return rejectWithValue(asErrorPayload(err).message);
    }
  },
);

// ── Slice ─────────────────────────────────────────

const userSlice = createSlice({
  name: 'user',
  initialState: {
    user: null,
    token: null,
    loading: false,
    error: null,
    sessionLoaded: false,
  },
  reducers: {
    clearError: state => {
      state.error = null;
    },
  },
  extraReducers: builder => {
    // Login
    builder
      .addCase(loginThunk.pending, s => {
        s.loading = true;
        s.error = null;
      })
      .addCase(loginThunk.fulfilled, (s, a) => {
        s.loading = false;
        s.user = a.payload.user;
        s.token = a.payload.token;
      })
      .addCase(loginThunk.rejected, (s, a) => {
        s.loading = false;
        s.error = a.payload;
      });

    // Register
    builder
      .addCase(registerThunk.pending, s => {
        s.loading = true;
        s.error = null;
      })
      .addCase(registerThunk.fulfilled, s => {
        s.loading = false;
      })
      .addCase(registerThunk.rejected, (s, a) => {
        s.loading = false;
        s.error = a.payload;
      });

    // Load session
    builder
      .addCase(loadSessionThunk.fulfilled, (s, a) => {
        s.sessionLoaded = true;
        if (a.payload) {
          s.user = a.payload.user;
          s.token = a.payload.token;
        }
      })
      .addCase(loadSessionThunk.rejected, s => {
        s.sessionLoaded = true;
      });

    // Fetch current user (session verification)
    builder.addCase(fetchMeThunk.fulfilled, (s, a) => {
      s.user = a.payload;
    });

    // Logout
    builder.addCase(logoutThunk.fulfilled, s => {
      s.user = null;
      s.token = null;
    });

    // Update profile
    builder
      .addCase(updateProfileThunk.fulfilled, (s, a) => {
        s.user = a.payload;
      })
      .addCase(updateProfileThunk.rejected, (s, a) => {
        s.error = a.payload;
      });
  },
});

export const {clearError} = userSlice.actions;
export default userSlice.reducer;
