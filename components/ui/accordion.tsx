"use client"

import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion"
import { ChevronDown } from "lucide-react"

import { cx as cn } from "@/components/ui/class-names"

function Accordion({ className, ...props }: AccordionPrimitive.Root.Props) {
  return <AccordionPrimitive.Root data-slot="accordion" className={cn("flex w-full flex-col", className)} {...props} />
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return <AccordionPrimitive.Item data-slot="accordion-item" className={cn("border-b border-border", className)} {...props} />
}

function AccordionTrigger({ className, children, ...props }: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group/accordion flex flex-1 cursor-pointer items-center justify-between gap-4 py-4 text-left text-body-lg font-medium text-foreground outline-none transition-colors duration-[80ms] hover:text-foreground/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-[180ms] ease-[var(--ease-out)] group-data-[panel-open]/accordion:rotate-180"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionPanel({ className, children, ...props }: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-panel"
      className={cn(
        "overflow-hidden text-body-lg text-muted-foreground transition-opacity duration-[180ms] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
        className,
      )}
      {...props}
    >
      <div className="max-w-[68ch] pb-5">{children}</div>
    </AccordionPrimitive.Panel>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionPanel }
