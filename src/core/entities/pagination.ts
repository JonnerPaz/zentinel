export interface PaginationResult<T> {
  data: T[];
  pagination: {
    hasMore: boolean;
    nextCursor: string | null;
    prevCursor: string | null;
    totalCount: number;
  };
}
