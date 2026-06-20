import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,       // data stays fresh for 30 s
      retry: 1,                // one retry on network error
      refetchOnWindowFocus: false, // Electron window focus shouldn't refetch
    },
  },
});
