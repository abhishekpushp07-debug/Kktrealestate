import type { ColumnDef } from "@tanstack/react-table";
import { Newspaper, Plus } from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { POST_STATUSES, POST_STATUS_LABELS, type CmsPostRow } from "@kkt/contracts";
import { Badge, Button, DataTable, PageHeader, Select, StatusChip, Toolbar } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useList, useListParams } from "@/lib/queries";
import { CMS_BREADCRUMBS } from "./CmsLayout";
import { POSTS_PATH, publicMediaUrl } from "./api";

const POST_FILTERS = ["status", "tag"] as const;

/** `/website/posts` — blog posts with a status filter; rows open the editor. */
export default function PostsPage() {
  const { can } = useAuth();
  const canWrite = can("cms.write");
  const navigate = useNavigate();
  const list = useListParams({ filterKeys: POST_FILTERS, defaultSort: "-created_at" });
  const query = useList<CmsPostRow>(POSTS_PATH, list.params);

  const columns = useMemo<ColumnDef<CmsPostRow, unknown>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Post",
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-3">
            {(row.original.cover_url ?? row.original.cover_document_id) ? <img src={row.original.cover_url ?? publicMediaUrl(row.original.cover_document_id, "thumb") ?? undefined} alt="" className="h-10 w-14 shrink-0 rounded-sm border border-border object-cover" loading="lazy" /> : <span className="flex h-10 w-14 shrink-0 items-center justify-center rounded-sm bg-navy-50 text-navy-700"><Newspaper className="size-4" aria-hidden="true" /></span>}
            <span className="min-w-0">
              <Link to={`/website/posts/${row.original.id}`} className="block truncate font-medium text-navy-800 hover:underline focus-ring rounded-xs" onClick={(event) => event.stopPropagation()}>
                {row.original.title}
              </Link>
              <span className="block truncate font-mono text-2xs text-ink-subtle">/blog/{row.original.slug}</span>
            </span>
          </span>
        ),
      },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusChip status={row.original.status} label={POST_STATUS_LABELS[row.original.status]} size="sm" /> },
      { id: "tags", header: "Tags", meta: { sortKey: false }, cell: ({ row }) => (row.original.tags.length ? <span className="flex flex-wrap gap-1">{row.original.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}</span> : <span className="text-ink-subtle">—</span>) },
      { accessorKey: "author_name", header: "Author", cell: ({ row }) => row.original.author_name ?? "—" },
      { accessorKey: "published_at", header: "Published", cell: ({ row }) => <span className="money text-ink-muted">{row.original.published_at ? formatDateTime(row.original.published_at) : "—"}</span> },
      { accessorKey: "updated_at", header: "Updated", meta: { hideOnMobile: true, sortKey: false }, cell: ({ row }) => <span className="money text-ink-muted">{formatDateTime(row.original.updated_at)}</span> },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Blog posts"
        description="News and articles in Markdown with SEO fields. Drafts are invisible on the website until published."
        breadcrumbs={[...CMS_BREADCRUMBS, { label: "Posts" }]}
        actions={
          canWrite ? (
            <Button asChild leftIcon={Plus}>
              <Link to="/website/posts/new" data-testid="post-new-btn">
                <Plus aria-hidden="true" /> New post
              </Link>
            </Button>
          ) : undefined
        }
      />
      <Toolbar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search title or slug…"
        filters={<Select aria-label="Status" size="sm" className="w-full sm:w-36" value={list.filters.status ?? null} onValueChange={(value) => list.setFilter("status", value)} options={POST_STATUSES.map((value) => ({ value, label: POST_STATUS_LABELS[value] }))} placeholder="Any status" allowClear data-testid="posts-filter-status" />}
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.reset}
        summary={query.data ? `${formatNumber(query.data.total)} posts` : undefined}
      />
      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        loading={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        onRowClick={(row) => navigate(`/website/posts/${row.id}`)}
        pagination={{ page: list.page, pageSize: list.pageSize, total: query.data?.total ?? 0, onPageChange: list.setPage, onPageSizeChange: list.setPageSize }}
        emptyState={{ icon: Newspaper, title: "No posts yet", description: "Write the first article — launches, construction milestones, buyer guides.", action: canWrite ? <Button asChild><Link to="/website/posts/new">New post</Link></Button> : undefined }}
        data-testid="posts-table"
      />
    </>
  );
}
