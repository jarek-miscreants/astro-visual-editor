export default {
  label: "Button",
  category: "CTA",
  description: "Reusable call-to-action button for marketing pages.",
  fields: {
    variant: {
      type: "choice",
      label: "Style",
      group: "Design",
      options: [
        { value: "primary", label: "Primary" },
        { value: "secondary", label: "Secondary" },
        { value: "ghost", label: "Ghost" }
      ]
    },
    size: {
      type: "choice",
      label: "Size",
      group: "Design",
      options: [
        { value: "sm", label: "Small" },
        { value: "md", label: "Medium" },
        { value: "lg", label: "Large" }
      ]
    },
    href: {
      type: "link",
      label: "Button link",
      group: "CTA",
      placeholder: "/pricing"
    },
    disabled: {
      type: "boolean",
      label: "Disabled",
      group: "State",
      advanced: true
    }
  }
};
