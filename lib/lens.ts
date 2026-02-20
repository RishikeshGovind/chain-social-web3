import axios from "axios";

const LENS_API = "https://api.lens.dev/";
type GraphQLError = { message: string };
type GraphQLResponse<TData> = {
  data?: TData;
  errors?: GraphQLError[];
};

export async function lensRequest<TData = Record<string, unknown>, TVariables = Record<string, unknown>>(
  query: string,
  variables?: TVariables,
  accessToken?: string
): Promise<TData> {
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.NODE_ENV === "production" ? "https://localhost" : "http://localhost:3000");

  const response = await axios.post<GraphQLResponse<TData>>(
    LENS_API,
    {
      query,
      variables,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...(accessToken && {
          Authorization: `Bearer ${accessToken}`,
        }),
      },
    }
  );

  if (response.data.errors && response.data.errors.length > 0) {
    console.error("Lens GraphQL Errors:", response.data.errors);
    throw new Error(response.data.errors[0]?.message ?? "Lens GraphQL request failed");
  }

  if (!response.data.data) {
    throw new Error("Lens response missing data");
  }

  return response.data.data;
}
