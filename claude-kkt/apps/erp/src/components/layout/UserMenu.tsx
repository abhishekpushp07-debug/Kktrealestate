import { ChevronDown, KeyRound, LogOut, MonitorSmartphone } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";

export function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  const handleLogout = async () => {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      setSigningOut(false);
      navigate("/login", { replace: true });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-9 items-center gap-2 rounded-md px-1.5 text-left hover:bg-navy-50 focus-ring sm:pr-2"
          aria-label="Account menu"
          data-testid="user-menu-trigger"
        >
          <Avatar name={user?.name} src={user?.avatar_url} size="sm" />
          <span className="hidden min-w-0 leading-tight md:block">
            <span className="block max-w-36 truncate text-sm font-semibold text-navy-950">{user?.name ?? "—"}</span>
            <span className="block max-w-36 truncate text-2xs text-ink-subtle">{user?.role.name}</span>
          </span>
          <ChevronDown className="hidden size-4 text-ink-subtle md:block" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="px-2 py-2">
          <p className="truncate text-sm font-semibold text-navy-950">{user?.name}</p>
          <p className="truncate text-xs text-ink-subtle">{user?.email}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {user?.role.name && <Badge variant="gold">{user.role.name}</Badge>}
            {user && !user.all_projects && <Badge variant="neutral">{user.project_ids.length} project{user.project_ids.length === 1 ? "" : "s"}</Badge>}
            {user?.mfa_enabled && <Badge variant="success">MFA on</Badge>}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Account</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => navigate("/change-password")} data-testid="user-menu-change-password">
          <KeyRound /> Change password
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/sessions")} data-testid="user-menu-sessions">
          <MonitorSmartphone /> Devices &amp; sessions
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive disabled={signingOut} onSelect={() => void handleLogout()} data-testid="user-menu-logout">
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
