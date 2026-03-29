# AusPac Insurance v1

## Standalone Requirements Document

Purpose:
- This document describes the first production-ready version of an insurance jobs workflow for AusPac.
- It is written as a business requirements brief that can be used for Octo AI testing, solution design, and acceptance planning.
- It is intentionally higher level than a manifest and lower level than a vague sales brief.

## 1. Business Context

AusPac handles insurer-driven solar inspection and make-safe work.

The business needs one operational system to manage:
- inbound insurance job requests
- scheduling and assignment
- customer confirmation
- contractor and installer coordination
- quote and proposal checkpoints
- work order generation
- job completion and reporting
- invoice request and invoice tracking

The system must support both office coordination and field execution, while keeping insurer, customer, and contractor details tied to the same job record.

## 2. Goals

The system should:
- provide one clear source of truth for every insurance job
- standardise the lifecycle from intake through completion
- reduce manual tracking across email, spreadsheets, and external systems
- make scheduling and customer confirmation visible to operations staff
- capture quote, proposal, reporting, and invoicing checkpoints
- support operational reporting by status, type, office, installer, and insurer

## 3. Primary Users

### Operations Coordinators
- receive and create jobs
- manage scheduling
- confirm customer bookings
- assign installers or internal resources
- track job progress and exceptions

### Office Managers
- oversee workload and bottlenecks
- review status progression
- monitor insurer turnaround and completion performance

### Field / Installer Contacts
- receive attendance details
- complete the requested work
- return findings and completion evidence

### Finance / Admin Staff
- request invoices
- confirm invoice references and sending status
- track completion before invoicing

## 4. Scope for v1

### In Scope
- insurance inspection and make-safe job tracking
- insurer, customer, and installer relationships
- status-based workflow management
- scheduling and confirmation tracking
- quote/proposal checkpoints
- work order tracking
- report completion and insurer delivery tracking
- invoice request and invoice sent tracking
- related activity logging
- rate / pricing lines for operational costing or allocation

### Out of Scope for v1
- full accounting inside OCTO
- full CRM sales pipeline
- advanced document generation engine
- live two-way sync with every external platform
- automated route optimisation
- technician mobile app specifics beyond normal OCTO record access

## 5. Core Record Types

The solution should include at least these core records.

### Insurance Job
The main operational record.

It should capture:
- job number
- job status
- job type
- source channel
- insurer
- customer
- service required
- insurer reference
- purchase order / work order number
- site address and location details
- roof access and complexity details
- quote / proposal checkpoints
- booking and assignment details
- inspection / attendance date
- customer confirmation details
- work order generation details
- external reference fields
- invoice fields
- report completion fields
- nearest office and travel / distance details

### Job Activity
Used to log significant actions or milestones against a job.

Examples:
- job received
- assigned to installer
- customer contacted
- booking confirmed
- quote requested
- report submitted
- invoice requested

### Job Rate Line
Used to track pricing, costing, or allocation lines related to a job.

Examples:
- insurer rate items
- installer rate items
- internal allocation lines
- travel or surcharge lines

## 6. Workflow Requirements

The main job workflow should support these states:
- Ready to Schedule
- Assigned (Pending Date)
- Assigned (Pending Customer)
- Pre-Inspection
- Inspection in Progress
- Post-Inspection Review
- Finalisation
- Completed
- On Hold
- Cancelled

The workflow should:
- provide clear status movement for office staff
- support both inspection-only and make-safe work
- allow jobs to pause cleanly
- prevent confusion between booked-but-unconfirmed jobs and active field jobs

## 7. Key Functional Requirements

### 7.1 Job Intake
- Staff must be able to create a new insurance job from email, portal, or manual entry.
- Each job must store both insurer and customer references.
- A job must not be considered valid without a job number, job type, insurer, and customer.

### 7.2 Scheduling and Assignment
- Staff must be able to assign the job to AusPac or a contractor.
- The system must support installer company and installer contact linkage.
- Operations must be able to record the intended attendance date and booking type.
- The system must track whether the customer has confirmed the booking and when.

### 7.3 Site and Access Details
- The system must capture site address and key location data.
- The system should capture access complexity such as roof storeys and multiple roof structures.
- These details should be visible before attendance is confirmed.

### 7.4 Quote and Proposal Control
- Staff must be able to record whether a quote is required.
- Staff must be able to record why a quote was triggered.
- Staff must be able to record whether the quote was sent and whether the decision was received.
- Staff must be able to record whether a proposal is required and the proposal status.

### 7.5 Work Order and External References
- The system must track whether a work order has been generated and when.
- The system should allow storage of references for:
  - TeamUp
  - Pipedrive project
  - Pipedrive deal
  - OpenSolar
  - Xero invoice

### 7.6 Completion and Reporting
- Staff must be able to record whether the job report is complete.
- Staff must be able to record whether the report has been sent to the insurer.
- Completed jobs must be clearly distinguishable from jobs still awaiting final admin work.

### 7.7 Finance Tracking
- Staff must be able to flag when an invoice has been requested.
- Staff must be able to flag when an invoice has been sent.
- Staff must be able to store the Xero invoice reference.

### 7.8 Activity Trail
- Important operational events should be logged against the job.
- The activity log should help staff understand what has happened without relying on email history.

### 7.9 Rate / Cost Lines
- A job may contain one or more rate lines.
- Rate lines should support operational costing and charge tracking.
- Totals should be understandable at job level.

## 8. Relationships

The system should support these relationships:
- one insurer to many jobs
- one customer to many jobs
- one installer company to many jobs
- one installer contact to many jobs
- one job to many activities
- one job to many rate lines

## 9. Business Rules

- A job must always have a clear owner or accountable operations handler.
- A completed job should not still look like it is awaiting scheduling.
- Quote and proposal flags must not be hidden from office staff.
- Invoice tracking must not happen before the relevant work/report milestone is complete.
- Cancelled jobs should remain visible in history but separate from active operational queues.
- On Hold jobs should remain reportable and easy to identify.

## 10. Suggested Automations for v1

These are recommended for v1, even if some are phased in after core setup.

### Intake Automation
- when a new job is created, log an activity entry such as `Job received`

### Scheduling Automation
- when an attendance date is set, log a scheduling activity
- when customer confirmation changes to yes, stamp confirmation date/time if missing

### Quote / Proposal Automation
- when quote required changes to yes, flag the job for review
- when proposal status moves to issued awaiting decision, log the milestone

### Completion Automation
- when report complete changes to yes, log completion milestone
- when invoice requested changes to yes, log finance handoff milestone

## 11. Dashboard and Reporting Requirements

The system should support reporting for:
- jobs by status
- jobs by type
- jobs by insurer
- jobs by office
- jobs by installer / contractor
- jobs awaiting customer confirmation
- jobs awaiting quote decision
- jobs awaiting report completion
- jobs awaiting invoice send
- completed jobs by week / month

## 12. Security and Access Expectations

- operations staff need full create/edit access
- finance/admin users need invoice-related visibility and update access
- management users need reporting visibility
- contractor/installer access, if enabled later, should be limited to relevant jobs and operational details

## 13. Acceptance Criteria for v1

v1 is acceptable when:
- staff can create and manage an insurance job end to end in one system
- each job clearly shows insurer, customer, installer, status, booking state, report state, and invoice state
- operations can tell what is blocked, booked, active, complete, or cancelled without external notes
- activities and rate lines stay linked to the correct job
- status and admin checkpoints support real operational reporting

## 14. Recommended Octo AI Test Prompt

Use this brief as a realistic Octo AI challenge.

Suggested prompt:

`Take this requirements document and build AusPac Insurance Jobs v1 as an OCTO app. Include the main job workflow, supporting activity and rate line records, insurer/customer/installer relationships, scheduling and confirmation tracking, quote/proposal checkpoints, completion/reporting, invoice tracking, and useful dashboards. Show me the draft plan first.`

## 15. Notes for Future Versions

Potential v2/v3 additions:
- insurer-specific SLA tracking
- document pack generation
- field technician mobile workflow optimisation
- deeper accounting sync
- richer contractor portal flows
- automated calendar sync and reminders
- customer communication templates
