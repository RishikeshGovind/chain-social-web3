
import axios from "axios";

const LENS_API = "https://api.lens.dev/";

export async function lensRequest(
  query: string,
  variables?: any,
  accessToken?: string
) {
  const response = await axios.post(
    LENS_API,
    {
      query,
      variables,
    },
    {
      headers: {
        "Content-Type": "application/json",
        "Origin": "http://localhost:3000",
        ...(accessToken && {
          Authorization: `Bearer ${accessToken}`,
        }),
      },
    }
  );

  if (response.data.errors) {
    console.error("Lens GraphQL Errors:", response.data.errors);
    throw new Error(response.data.errors[0].message);
  }

  return response.data.data;
}
