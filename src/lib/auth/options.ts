import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import type { JWT } from "next-auth/jwt";
import type { Session, User } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { users, memberships, companies } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { verifyPassword } from "@/lib/auth/password";

type AppUser = User & {
  authVersion: number;
  companyId: string;
  role: "gestor" | "operador";
  companyName: string;
  timezone: string;
};

type AppSession = Session & {
  user: {
    id: string;
    companyId: string;
    role: "gestor" | "operador";
    companyName: string;
    timezone: string;
    authVersion: number;
  } & Session["user"];
};

const authOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Senha", type: "password" },
        companyId: { label: "Empresa", type: "text" },
      },
      async authorize(credentials) {
        const email =
          typeof credentials?.email === "string" ? credentials.email.toLowerCase().trim() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;

        const [user] = await db
          .select()
          .from(users)
          .where(and(eq(users.email, email), eq(users.active, true)))
          .limit(1);
        if (!user) return null;
        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;

        const [membership] = await db
          .select({
            companyId: memberships.companyId,
            role: memberships.role,
            companyName: companies.name,
            timezone: companies.timezone,
          })
          .from(memberships)
          .innerJoin(companies, eq(memberships.companyId, companies.id))
          .where(and(eq(memberships.userId, user.id), eq(memberships.active, true), ...(typeof credentials?.companyId === "string" && /^[a-f0-9-]{36}$/.test(credentials.companyId) ? [eq(memberships.companyId, credentials.companyId)] : [])))
          .limit(1);
        if (!membership) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          companyId: membership.companyId,
          role: membership.role,
          companyName: membership.companyName,
          timezone: membership.timezone,
          authVersion: user.authVersion,
        } satisfies AppUser;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }: { token: JWT; user?: User | { id?: string }; trigger?: "signIn" | "signUp" | "update"; session?: unknown }) {
      const u = user as Partial<AppUser> | undefined;
      if (u?.id) {
        token.id = u.id;
        token.companyId = u.companyId;
        token.role = u.role;
        token.companyName = u.companyName;
        token.timezone = u.timezone;
        token.authVersion = u.authVersion;
      }
      if (trigger === "update" && session && typeof session === "object" && "user" in session && session.user && typeof session.user === "object" && "companyId" in session.user) {
        const companyId = session.user.companyId;
        if (typeof companyId !== "string" || !/^[a-f0-9-]{36}$/.test(companyId)) throw new Error("Empresa inválida");
        const [member] = await db.select({ companyId: memberships.companyId, role: memberships.role, companyName: companies.name, timezone: companies.timezone, authVersion: users.authVersion }).from(memberships)
          .innerJoin(companies, eq(companies.id, memberships.companyId)).innerJoin(users, eq(users.id, memberships.userId))
          .where(and(eq(memberships.userId, String(token.id ?? token.sub)), eq(memberships.companyId, companyId), eq(memberships.active, true), eq(users.active, true)));
        if (!member || member.authVersion !== (token.authVersion ?? 1)) throw new Error("Acesso à empresa não autorizado");
        Object.assign(token, member);
      }
      return token;
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      const s = session as AppSession;
      if (s.user && token.sub) {
        s.user.id = (token.id as string) ?? token.sub;
        s.user.companyId = token.companyId as string;
        s.user.role = token.role as "gestor" | "operador";
        s.user.companyName = (token.companyName as string) ?? "";
        s.user.timezone = (token.timezone as string) ?? "America/Bahia";
        s.user.authVersion = (token.authVersion as number) ?? 1;
      }
      return s;
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth(authOptions);
export type { AppSession, AppUser };
