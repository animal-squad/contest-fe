import axios from "axios";
import socketService from "./socket";
import { Toast } from "../components/Toast";
import axiosInstance from "../services/axios";

class AuthService {
  async login(credentials) {
    try {
      const response = await axiosInstance.post(`/auth/login`, credentials);

      if (response.data?.success && response.data?.token) {
        const userData = {
          id: response.data.user._id,
          name: response.data.user.name,
          email: response.data.user.email,
          profileImage: response.data.user.profileImage,
          token: response.data.token,
          sessionId: response.data.sessionId,
          lastActivity: Date.now(),
        };

        localStorage.setItem("user", JSON.stringify(userData));
        window.dispatchEvent(new Event("authStateChange"));
        return userData;
      }

      throw new Error(response.data?.message || "로그인에 실패했습니다.");
    } catch (error) {
      console.error("Login error:", error);

      if (error.response?.status === 401) {
        Toast.error("이메일 주소가 없거나 비밀번호가 틀렸습니다.");
        throw new Error("이메일 주소가 없거나 비밀번호가 틀렸습니다.");
      }

      if (error.response?.status === 429) {
        Toast.error(
          "너무 많은 로그인 시도가 있었습니다. 잠시 후 다시 시도해주세요."
        );
        throw new Error("너무 많은 로그인 시도가 있었습니다.");
      }

      if (!error.response) {
        Toast.error("서버와 통신할 수 없습니다. 잠시 후 다시 시도해주세요.");
        throw new Error("서버와 통신할 수 없습니다.");
      }

      const errorMessage =
        error.response?.data?.message || "로그인 중 오류가 발생했습니다.";
      Toast.error(errorMessage);
      throw new Error(errorMessage);
    }
  }

  // logout 메소드 수정
  async logout() {
    try {
      const user = this.getCurrentUser();
      if (user?.token) {
        await axiosInstance.post("/auth/logout");
      }
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      console.log("??????");
      socketService.disconnect();
      localStorage.removeItem("user");
      // 인증 상태 변경 이벤트 발생
      window.dispatchEvent(new Event("authStateChange"));
      window.location.href = "/";
    }
  }

  // register 메소드 수정
  async register(userData) {
    try {
      const response = await axiosInstance.post("/auth/register", userData);

      if (response.data?.success && response.data?.token) {
        const userInfo = {
          id: response.data.user._id,
          name: response.data.user.name,
          email: response.data.user.email,
          profileImage: response.data.user.profileImage,
          token: response.data.token,
          sessionId: response.data.sessionId,
          lastActivity: Date.now(),
        };
        localStorage.setItem("user", JSON.stringify(userInfo));

        // 인증 상태 변경 이벤트 발생
        window.dispatchEvent(new Event("authStateChange"));

        return userInfo;
      }

      throw new Error(response.data?.message || "회원가입에 실패했습니다.");
    } catch (error) {
      console.error("Registration error:", error);
      throw this._handleError(error);
    }
  }

  async updateProfile(data) {
    try {
      const user = this.getCurrentUser();
      if (!user?.token) {
        throw new Error("인증 정보가 없습니다.");
      }

      const response = await axiosInstance.put(`/users/profile`, data, {
        headers: {
          "Content-Type": "application/json",
          "x-auth-token": user.token,
          "x-session-id": user.sessionId,
        },
      });

      if (response.data?.success) {
        // 현재 사용자 정보 업데이트
        const updatedUser = {
          ...user,
          ...response.data.user,
          token: user.token,
          sessionId: user.sessionId,
        };

        localStorage.setItem("user", JSON.stringify(updatedUser));
        window.dispatchEvent(new Event("userProfileUpdate"));

        return updatedUser;
      }

      throw new Error(
        response.data?.message || "프로필 업데이트에 실패했습니다."
      );
    } catch (error) {
      console.error("Profile update error:", error);

      if (error.response?.status === 401) {
        try {
          const refreshed = await this.refreshToken();
          if (refreshed) {
            return this.updateProfile(data);
          }
        } catch (refreshError) {
          throw new Error("인증이 만료되었습니다. 다시 로그인해주세요.");
        }
      }

      throw this._handleError(error);
    }
  }

  async changePassword(currentPassword, newPassword) {
    try {
      const user = this.getCurrentUser();
      if (!user?.token) {
        throw new Error("인증 정보가 없습니다.");
      }

      const response = await axiosInstance.put(
        `/users/profile`,
        {
          currentPassword,
          newPassword,
        },
        {
          headers: {
            "Content-Type": "application/json",
            "x-auth-token": user.token,
            "x-session-id": user.sessionId,
          },
        }
      );

      if (response.data?.success) {
        return true;
      }

      throw new Error(
        response.data?.message || "비밀번호 변경에 실패했습니다."
      );
    } catch (error) {
      console.error("Password change error:", error);

      if (error.response?.status === 401) {
        if (
          error.response.data?.message?.includes("비밀번호가 일치하지 않습니다")
        ) {
          throw new Error("현재 비밀번호가 일치하지 않습니다.");
        }

        try {
          const refreshed = await this.refreshToken();
          if (refreshed) {
            return this.changePassword(currentPassword, newPassword);
          }
        } catch (refreshError) {
          throw new Error("인증이 만료되었습니다. 다시 로그인해주세요.");
        }
      }

      throw this._handleError(error);
    }
  }

  getCurrentUser() {
    try {
      const userStr = localStorage.getItem("user");
      if (!userStr) return null;

      const user = JSON.parse(userStr);
      const SESSION_TIMEOUT = 2 * 60 * 60 * 1000;

      if (Date.now() - user.lastActivity > SESSION_TIMEOUT) {
        this.logout();
        return null;
      }

      user.lastActivity = Date.now();
      localStorage.setItem("user", JSON.stringify(user));
      return user;
    } catch (error) {
      console.error("Get current user error:", error);
      this.logout();
      return null;
    }
  }

  async verifyToken() {
    try {
      const user = this.getCurrentUser();
      if (!user?.token || !user?.sessionId) {
        throw new Error("No authentication data found");
      }

      // 토큰 검증 상태를 로컬 스토리지에 저장
      const lastVerification = localStorage.getItem("lastTokenVerification");
      const verificationInterval = 5 * 60 * 1000; // 5분

      // 마지막 검증 후 5분이 지나지 않았다면 추가 검증 스킵
      if (
        lastVerification &&
        Date.now() - parseInt(lastVerification) < verificationInterval
      ) {
        return true;
      }

      const response = await axiosInstance.post("/auth/verify-token", {
        headers: {
          "x-auth-token": user.token,
          "x-session-id": user.sessionId,
        },
      });

      if (response.data.success) {
        // 토큰 검증 시간 업데이트
        localStorage.setItem("lastTokenVerification", Date.now().toString());
        return true;
      }

      throw new Error(response.data.message || "토큰 검증에 실패했습니다.");
    } catch (error) {
      if (error.response?.status === 401) {
        try {
          await this.refreshToken();
          localStorage.setItem("lastTokenVerification", Date.now().toString());
          return true;
        } catch (refreshError) {
          this.logout();
          throw new Error("세션이 만료되었습니다. 다시 로그인해주세요.");
        }
      }
      throw error;
    }
  }

  async refreshToken() {
    try {
      const user = this.getCurrentUser();
      if (!user?.token) throw new Error("인증 정보가 없습니다.");

      const response = await axiosInstance.post("/auth/refresh-token");

      if (response.data.success && response.data.token) {
        const updatedUser = {
          ...user,
          token: response.data.token,
          lastActivity: Date.now(),
        };
        localStorage.setItem("user", JSON.stringify(updatedUser));
        return response.data.token;
      }

      throw new Error("토큰 갱신에 실패했습니다.");
    } catch (error) {
      console.error("Token refresh error:", error);
      throw this._handleError(error);
    }
  }

  async checkServerConnection() {
    try {
      const response = await axiosInstance.get("/health", {
        timeout: 5000,
        retry: 2,
        retryDelay: 1000,
      });
      return response.data.status === "ok";
    } catch (error) {
      console.error("Server connection check failed:", error);
      throw this._handleError(error);
    }
  }

  _handleError(error) {
    if (error.isNetworkError) return error;

    if (axios.isAxiosError(error)) {
      if (!error.response) {
        return new Error(
          "서버와 통신할 수 없습니다. 네트워크 연결을 확인해주세요."
        );
      }

      const { status, data } = error.response;
      const message = data?.message || error.message;

      switch (status) {
        case 400:
          return new Error(message || "입력 정보를 확인해주세요.");
        case 401:
          return new Error(message || "인증에 실패했습니다.");
        case 403:
          return new Error(message || "접근 권한이 없습니다.");
        case 404:
          return new Error(message || "요청한 리소스를 찾을 수 없습니다.");
        case 429:
          return new Error(
            message ||
              "너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해주세요."
          );
        case 500:
          return new Error(
            message || "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
          );
        default:
          return new Error(message || "요청 처리 중 오류가 발생했습니다.");
      }
    }

    return error;
  }
}

const authService = new AuthService();
export default authService;
