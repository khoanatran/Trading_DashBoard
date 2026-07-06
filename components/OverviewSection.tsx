'use client'

import React from 'react'

interface OverviewSectionProps {
  title: string
  description?: string
  children: React.ReactNode
  id?: string
  className?: string
}

export default function OverviewSection({
  title,
  description,
  children,
  id,
  className = '',
}: OverviewSectionProps) {
  return (
    <section id={id} className={`scroll-mt-24 ${className}`}>
      <div className="mb-4">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">{description}</p>
        )}
      </div>
      {children}
    </section>
  )
}
