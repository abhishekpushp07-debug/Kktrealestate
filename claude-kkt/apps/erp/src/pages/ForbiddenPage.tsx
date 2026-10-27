import { ShieldAlert } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export function ForbiddenPage() {
  const navigate = useNavigate();
  return (
    <Card className="mx-auto mt-6 max-w-xl">
      <EmptyState
        icon={ShieldAlert}
        title="You don't have access to this page"
        description="Your role does not include the permission this screen needs. Ask a Super Admin if you believe you should have it."
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

export default ForbiddenPage;
