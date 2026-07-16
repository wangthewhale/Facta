import { useToast } from "@/hooks/use-toast"

export function Toaster() {
  const { toasts } = useToast()

  return (
    <div className="fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]">
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <div key={id} className="mb-2 bg-foreground text-background p-4 shadow-lg border border-border flex flex-col gap-1">
            {title && <div className="font-bold text-sm tracking-wide">{title}</div>}
            {description && <div className="text-xs opacity-90">{description}</div>}
            {action}
          </div>
        )
      })}
    </div>
  )
}
