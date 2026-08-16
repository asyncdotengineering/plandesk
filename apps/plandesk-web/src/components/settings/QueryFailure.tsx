import { Button } from '@/components/ui/button';

export function QueryFailure({
  message,
  onRetry,
  isRetrying = false,
}: {
  message: string;
  onRetry: () => void;
  isRetrying?: boolean;
}) {
  return (
    <div className="grid justify-items-start gap-2">
      <p role="alert" className="text-sm text-destructive">
        {message}
      </p>
      <Button type="button" variant="outline" size="sm" disabled={isRetrying} onClick={onRetry}>
        {isRetrying ? 'Retrying…' : 'Retry'}
      </Button>
    </div>
  );
}
