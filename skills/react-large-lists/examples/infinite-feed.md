# Example: An Infinite Activity Feed

A team workspace has an activity feed: comments, status changes and uploads, loaded 30 at a time from a cursor-based API.

## Step 1: the query and the sentinel

```tsx
import { useInfiniteQuery } from '@tanstack/react-query';
import { useInView } from './use-in-view'; // react-large-lists/assets

function ActivityFeed({ workspaceId }: { workspaceId: string }) {
  const feed = useInfiniteQuery({
    queryKey: ['activity', workspaceId],
    queryFn: ({ pageParam, signal }) => fetchActivity(workspaceId, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined, // undefined = no more pages
  });

  const [sentinelRef, nearEnd] = useInView<HTMLDivElement>({ rootMargin: '600px 0px' });
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = feed;

  useEffect(() => {
    if (nearEnd && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      fetchNextPage();
    }
  }, [nearEnd, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  if (feed.status === 'pending') return <FeedSkeleton />;
  if (feed.status === 'error') return <FeedError onRetry={() => feed.refetch()} />;

  const items = feed.data.pages.flatMap((page) => page.items);

  return (
    <section aria-label="Activity" aria-busy={isFetchingNextPage}>
      <ul className="feed">
        {items.map((item) => (
          <li key={item.id}>
            <ActivityItem item={item} />
          </li>
        ))}
      </ul>

      <div ref={sentinelRef} className="feed__sentinel" />

      {isFetchingNextPage && <FeedRowsSkeleton count={3} />}
      {isFetchNextPageError && (
        <p>
          Couldn't load more activity. <button onClick={() => fetchNextPage()}>Try again</button>
        </p>
      )}
      {hasNextPage && !isFetchingNextPage && !isFetchNextPageError && (
        <button onClick={() => fetchNextPage()}>Load more</button>
      )}
      {!hasNextPage && <p className="feed__end">You're all caught up.</p>}
    </section>
  );
}
```

How the guards work:

- **`rootMargin: '600px 0px'`** asks for the next page while the user is still a screen or so away from the end, so new items are usually ready before they're needed.
- **The effect re-checks after each fetch.** If the sentinel is still near the viewport when a page arrives (a tall screen, short items), `isFetchingNextPage` flips back to `false` and the effect requests the next page. It stops when the screen is full.
- **No loop on errors.** `isFetchNextPageError` stops automatic requests; the user retries explicitly. Without that guard, a failing endpoint gets hit as fast as the effect can re-run.
- **A "Load more" button** stays available for keyboard and screen reader users, and for when the observer can't fire (a print view, a test environment).
- **An end state** tells users the list is complete, and stops the sentinel from mattering.
- **The query passes `signal` through** so TanStack Query can cancel a page request when the feed unmounts or the workspace changes.

## Step 2: keep it fast after hundreds of pages

After a long session, the feed holds thousands of items and every new page re-renders the whole list. Two fixes, in order:

1. **Memoize items.** `ActivityItem` wrapped in `memo`, with stable props. TanStack Query's structural sharing keeps unchanged pages' objects identical across refetches, so existing items skip re-rendering.
2. **Virtualize, and trigger from the virtual range** instead of a DOM sentinel:

```tsx
const virtualizer = useVirtualizer({
  count: hasNextPage ? items.length + 1 : items.length, // one extra row for the loading indicator
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 88,
  overscan: 6,
  getItemKey: (index) => items[index]?.id ?? 'loader',
});

const virtualItems = virtualizer.getVirtualItems();
const lastIndex = virtualItems.at(-1)?.index ?? -1;

useEffect(() => {
  if (lastIndex >= items.length - 5 && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
    fetchNextPage();
  }
}, [lastIndex, items.length, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
```

Feed items vary in height (comments wrap, uploads have previews), so render each virtual row with `ref={virtualizer.measureElement}` and `data-index`, as in `examples/virtualized-table.md`.

## Step 3: details users notice

- **Back navigation:** returning from an item's detail page should restore both the loaded pages and the scroll position. TanStack Query keeps the pages cached; restore the scroll offset from the router's scroll restoration, or save `virtualizer.scrollOffset` in session storage and pass it as `initialOffset`.
- **New activity at the top:** don't insert it above what the user is reading, because that pushes content down. Show a "3 new updates" button that prepends and scrolls up when clicked.
- **Footer links:** an endless feed makes the page footer unreachable. Put footer links in a sidebar or menu as well.
- **Memory:** for feeds that can grow without limit, cap the cached pages (`maxPages` in TanStack Query v5) and accept refetching when users scroll back up.
