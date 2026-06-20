import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/query";
import { Shell } from "./shell/Shell";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}
