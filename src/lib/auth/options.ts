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
          .where(eq(memberships.userId, user.id))
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
        } satisfies AppUser;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }: { token: JWT; user?: User | { id?: string } }) {
      const u = user as Partial<AppUser> | undefined;
      if (u?.id) {
        token.id = u.id;
        token.companyId = u.companyId;
        token.role = u.role;
        token.companyName = u.companyName;
        token.timezone = u.timezone;
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
      }
      return s;
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authOptions);
export type { AppSession, AppUser };
