import { KanbanSkeleton } from "@/components/skeletons/KanbanSkeleton";

export default function ProjectDetailLoading() {
  return (
    <div className="max-w-[1700px] mx-auto">
      <KanbanSkeleton />
    </div>
  );
}
