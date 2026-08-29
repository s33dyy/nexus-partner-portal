import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldGrid, FormDialog } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { listOutreachCustomers } from "@/integrations/local/outreach";
import type { OutreachCustomerOption } from "@/server/outreach-queries.server";

/**
 * Enrolment.
 *
 * Linking a Customer is optional but strongly encouraged by the layout,
 * because it is what gives {{company}}/{{country}}/{{segment}} something to
 * resolve to and what lets "a deal was opened" stop the cadence by itself.
 * The per-contact note is the other half of HubSpot's enrolment step: one
 * line that goes only to this person, above the templated body.
 */

export type ContactDraft = {
  customerId: string;
  contactName: string;
  contactEmail: string;
  personalNote: string;
};

export const EMPTY_CONTACT: ContactDraft = {
  customerId: "",
  contactName: "",
  contactEmail: "",
  personalNote: "",
};

const NO_CUSTOMER = "__none__";

export function EnrollDialog({
  open,
  onOpenChange,
  sequenceName,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sequenceName: string;
  busy: boolean;
  onSubmit: (contacts: ContactDraft[]) => void | Promise<void>;
}) {
  const [contacts, setContacts] = useState<ContactDraft[]>([{ ...EMPTY_CONTACT }]);
  const [customers, setCustomers] = useState<OutreachCustomerOption[]>([]);
  // Every customer that has been picked on some row, kept regardless of what
  // the search currently matches. Without this, narrowing the search after
  // choosing a customer drops that option out of the Select, which then falls
  // back to rendering its placeholder — the row reads "No customer linked"
  // while contact.customerId still holds the id that gets submitted. The
  // display would be lying about what is about to be sent.
  const [pinned, setPinned] = useState<OutreachCustomerOption[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void listOutreachCustomers(search).then((result) => {
        if (cancelled) return;
        setCustomers(result.ok ? result.data : []);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, search]);

  useEffect(() => {
    if (open) {
      setContacts([{ ...EMPTY_CONTACT }]);
      setPinned([]);
      setSearch("");
    }
  }, [open]);

  const options = useMemo(() => {
    const byId = new Map(customers.map((customer) => [customer.id, customer]));
    for (const customer of pinned) {
      if (!byId.has(customer.id)) byId.set(customer.id, customer);
    }
    return [...byId.values()].sort((a, b) => a.companyName.localeCompare(b.companyName));
  }, [customers, pinned]);

  const update = useCallback((index: number, patch: Partial<ContactDraft>) => {
    setContacts((current) =>
      current.map((contact, i) => (i === index ? { ...contact, ...patch } : contact)),
    );
  }, []);

  const ready = contacts.some((contact) => contact.contactEmail.trim() !== "");

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Enrol contacts in “${sequenceName}”`}
      description="The first step goes out on the next sweep; the rest follow on the schedule you set."
      size="lg"
      busy={busy}
      busyLabel="Enrolling…"
      submitLabel={`Enrol ${contacts.filter((c) => c.contactEmail.trim()).length || ""}`.trim()}
      submitDisabled={!ready}
      onSubmit={() => onSubmit(contacts.filter((contact) => contact.contactEmail.trim() !== ""))}
    >
      <Field label="Find a customer" htmlFor="enroll-search">
        <Input
          id="enroll-search"
          value={search}
          placeholder="Search customers by company name"
          onChange={(event) => setSearch(event.target.value)}
        />
      </Field>

      <div className="space-y-3">
        {contacts.map((contact, index) => (
          <div key={index} className="space-y-3 rounded-md border bg-card p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Contact {index + 1}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive"
                aria-label={`Remove contact ${index + 1}`}
                disabled={contacts.length === 1}
                onClick={() => setContacts((current) => current.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            <FieldGrid columns={2}>
              <Field label="Name" htmlFor={`contact-name-${index}`}>
                <Input
                  id={`contact-name-${index}`}
                  value={contact.contactName}
                  placeholder="Devon Sharma"
                  onChange={(event) => update(index, { contactName: event.target.value })}
                />
              </Field>
              <Field label="Email" htmlFor={`contact-email-${index}`} required>
                <Input
                  id={`contact-email-${index}`}
                  type="email"
                  value={contact.contactEmail}
                  placeholder="devon@acme.com"
                  onChange={(event) => update(index, { contactEmail: event.target.value })}
                />
              </Field>
            </FieldGrid>

            <Field
              label="Customer"
              hint="Supplies {{company}}, {{country}} and {{segment}}, and lets a new deal stop the cadence."
            >
              <Select
                value={contact.customerId || NO_CUSTOMER}
                onValueChange={(value) => {
                  if (value === NO_CUSTOMER) {
                    update(index, { customerId: "" });
                    return;
                  }
                  const picked = options.find((customer) => customer.id === value);
                  if (picked) {
                    setPinned((current) =>
                      current.some((entry) => entry.id === picked.id)
                        ? current
                        : [...current, picked],
                    );
                  }
                  update(index, { customerId: value });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No customer linked" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CUSTOMER}>No customer linked</SelectItem>
                  {options.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.companyName}
                      {customer.country ? ` — ${customer.country}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Personal line (first email only)"
              htmlFor={`contact-note-${index}`}
              hint="Goes above the template, to this person only."
            >
              <Textarea
                id={`contact-note-${index}`}
                rows={2}
                value={contact.personalNote}
                placeholder="Great to meet you at the Mumbai expo — hope the stand went well."
                onChange={(event) => update(index, { personalNote: event.target.value })}
              />
            </Field>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start"
        onClick={() => setContacts((current) => [...current, { ...EMPTY_CONTACT }])}
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Another contact
      </Button>
    </FormDialog>
  );
}
