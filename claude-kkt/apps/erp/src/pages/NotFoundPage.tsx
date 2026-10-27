import { FileWarning } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Card className="mx-auto mt-6 max-w-xl">
      <EmptyState
        icon={FileWarning}
        title="Page not found"
        description="The link may be outdated, or the record is outside your project scope."
        action={
          <>
            <Button variant="outline" onClick={() => navigate(-1)}>
              Go back
            </Button>
            <Button asChild>
              <Link to="/">Go to dashboard</Link>
            </Button>
          </>
        }
      />
    </Card>
  );
}

export default NotFoundPage;
