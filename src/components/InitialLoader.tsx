import type { ReactNode } from "react";
import "./InitialLoader.css";

type InitialLoaderProps = {
  label: ReactNode;
};

export default function InitialLoader({ label }: InitialLoaderProps) {
  return (
    <div className="initial-loader">
      <div className="initial-loader-logo" aria-label={label as string}>
        xMarket
        <span className="initial-loader-shimmer" aria-hidden="true" />
      </div>
    </div>
  );
}
