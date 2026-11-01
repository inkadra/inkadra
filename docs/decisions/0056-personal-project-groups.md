# 0056 — Personal project groups

## Context

Freelancers and studios keep many projects for the same client or series and want to group
them in the sidebar and on the Projects page (#313). A group could belong to the person or be
shared by everyone on the instance or project.

## Decision

Groups are personal. `project_group` belongs to one user (name, one of six tag colours,
fractional position, folded or not); `project_group_item` puts one of that user's projects in
one of their groups, with a position inside it. A project is in at most one group per person.
Composite foreign keys tie the item to the person's membership of the project and to a group of
the same person, so a group can never hold someone else's projects or another person's group.

A group is organisation only and changes no permission. Any signed-in person manages their own
groups and can put in them any project they are a member of, whatever their role; nobody else,
administrators included, reads or changes them (another person's group answers `not_found`).
Leaving a project takes it out of the group; dissolving a group never touches its projects,
which show again outside any group. The order of groups and of projects inside a group is
stored on the server, as is whether a group is folded, so it follows the person across devices.
Clients move items with `before: <id>` and the server computes the fractional key.

Ungrouped projects keep the shared project order. On the Projects page the chosen sort applies
inside every group; the sidebar shows the person's own order. On phones there is no dragging:
a long press opens the project menu, whose "Move to group…" is also the keyboard way.

Project export carries no group, as it carries no pin: both are personal. Instance backups
include the tables like every other one.

## Consequences

Shared groups (a studio's client list) would be a new feature on top, not a change to these
tables. People who share many projects each sort them their own way.
