import type { ReactNode } from "react";
import "./LoadingScreen.css";

type LoadingScreenProps = {
  message: ReactNode;
};

export default function LoadingScreen({ message }: LoadingScreenProps) {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-spinner" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}
