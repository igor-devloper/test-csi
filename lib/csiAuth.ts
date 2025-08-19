import axios from "axios";



export async function mintOrgAccessToken(orgId: number): Promise<string> {
  const refresh = (process.env.CSI_REFRESH ?? "").trim();
  if (!refresh) throw new Error("CSI_REFRESH ausente");

  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    identity_type: "2",    // “login de org”
    client_id: "test",
    org_id: String(orgId),
  });
  const TOKEN_URL = process.env.CSI_TOKEN_URL!;
  if (!TOKEN_URL) {
    throw new Error("Faltou configurar CSI_TOKEN_URL no .env.local");
  }
  const res = await axios.post(TOKEN_URL, form.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
  });
  const token = res.data?.access_token as string | undefined;
  if (!token) throw new Error("Falha ao gerar access_token da org " + orgId);
  return token;
}
