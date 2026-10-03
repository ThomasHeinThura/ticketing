import { createFileRoute } from "@tanstack/react-router";
import { ErrorDisplay } from "@/components/errors/error-display";

export const Route = createFileRoute("/test-error")({
  component: TestErrorComponent,
});

function TestErrorComponent() {
  return (
    <div className="min-h-screen bg-background">
      <div className="p-4">
        <h2 className="mb-4 text-lg font-semibold">Error Handling Test</h2>
        <ErrorDisplay
          error={
            new Error(
              "Failed to connect to API server at https://api.andrej.com. This might be due to CORS configuration issues or the server not running. Please check your environment variables and server status.",
            )
          }
          title="Test Error"
          className="min-h-[300px]"
        />
      </div>
    </div>
  );
}
