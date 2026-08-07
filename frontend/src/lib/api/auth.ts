import { apiClient } from "./client";

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface UserResponse {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
}

export interface AuthResponse {
  tokens: TokenResponse;
  user: UserResponse;
}

export const authAPI = {
  async login(email: string, password: string): Promise<AuthResponse> {
    const { data } = await apiClient.post<AuthResponse>("/auth/login", { email, password });
    return data;
  },

  async register(email: string, password: string, fullName?: string): Promise<AuthResponse> {
    const { data } = await apiClient.post<AuthResponse>("/auth/register", {
      email,
      password,
      full_name: fullName,
    });
    return data;
  },

  async refreshToken(refreshToken: string): Promise<TokenResponse> {
    const { data } = await apiClient.post<TokenResponse>("/auth/refresh", {
      refresh_token: refreshToken,
    });
    return data;
  },

  async getMe(): Promise<UserResponse> {
    const { data } = await apiClient.get<UserResponse>("/auth/me");
    return data;
  },
};
