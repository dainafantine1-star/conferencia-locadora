import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      companyId: string;
      role: "gestor" | "operador";
      companyName: string;
      timezone: string;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    companyId: string;
    role: "gestor" | "operador";
    companyName: string;
    timezone: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    companyId?: string;
    role?: string;
    companyName?: string;
    timezone?: string;
  }
}
