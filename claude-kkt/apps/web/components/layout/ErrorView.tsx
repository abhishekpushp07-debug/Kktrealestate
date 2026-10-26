"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/Button";

export function ErrorView({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="bg-navy-900 text-ivory-100">
      <div className="container-site flex min-h-[70vh] flex-col items-start justify-center py-32">
        <p className="eyebrow text-gold-300">Something went wrong</p>
        <h1 className="mt-4 max-w-2xl font-display text-display-lg">We are briefly unable to load this page.</h1>
        <p className="mt-6 max-w-xl text-lg leading-8 text-ivory-100/75">
          Our team has been notified. Please try again in a moment, or call us and we will be glad to help.
        </p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Button onClick={reset}>Try again</Button>
          <Button href="/" variant="outline-light">
            Back to home
          </Button>
        </div>
        {error.digest ? <p className="mt-8 text-xs text-ivory-100/40">Reference {error.digest}</p> : null}
      </div>
    </div>
  );
}
