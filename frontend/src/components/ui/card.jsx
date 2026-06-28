import * as React from "react";

function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

const Card = React.forwardRef(function Card({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn("rounded-xl border border-border bg-card text-card-foreground shadow-sm", className)}
      {...props}
    />
  );
});

const CardHeader = React.forwardRef(function CardHeader({ className, ...props }, ref) {
  return <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />;
});

const CardTitle = React.forwardRef(function CardTitle({ className, ...props }, ref) {
  return <h3 ref={ref} className={cn("text-lg font-semibold leading-none", className)} {...props} />;
});

const CardContent = React.forwardRef(function CardContent({ className, ...props }, ref) {
  return <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />;
});

export { Card, CardHeader, CardTitle, CardContent };
