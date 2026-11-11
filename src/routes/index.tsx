import { createFileRoute } from "@tanstack/react-router";
import { CcApp } from "@/components/cc-app";

export const Route = createFileRoute("/")({ component: CcApp });
