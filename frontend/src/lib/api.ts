import createClient from "openapi-fetch";
import type { paths } from "@/lib/api-schema";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export const api = createClient<paths>({
  baseUrl: API_URL,
  credentials: "include",
});
