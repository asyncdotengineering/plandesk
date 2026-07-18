import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { MoonIcon, SunIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Light/dark theme toggle. next-themes persists the choice in localStorage and
 * applies `.dark` on <html>; default follows the OS (`prefers-color-scheme`).
 *
 * Renders nothing until mounted: the theme is read from localStorage on the
 * client, so the SSR/first-paint icon would mismatch the resolved theme. The
 * flash is handled by `disableTransitionOnChange` + a near-invisible placeholder.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = resolvedTheme === 'dark';

  return (
    <button
      type="button"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Light theme' : 'Dark theme'}
      onClick={() => {
        setTheme(isDark ? 'light' : 'dark');
      }}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
        className,
      )}
    >
      {mounted && isDark ? <MoonIcon className="size-4" /> : <SunIcon className="size-4" />}
    </button>
  );
}
