import { Link } from "@tanstack/react-router";

type LogoProps = {
  className?: string;
};

export function Logo({ className = "" }: LogoProps) {
  return (
    <Link to="/dashboard" className={`w-auto ${className}`}>
      <img
        src="/logo-dark.svg"
        alt="TaskDesk"
        className="h-6 w-auto dark:hidden"
      />
      <img
        src="/logo-light.svg"
        alt="TaskDesk"
        className="hidden h-6 w-auto dark:block"
      />
    </Link>
  );
}
