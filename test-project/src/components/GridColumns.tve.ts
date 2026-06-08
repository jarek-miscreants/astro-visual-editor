export default {
  label: "Feature Grid",
  category: "Sections",
  description: "A marketer-safe feature grid section for landing pages.",
  thumbnail: "/images/zafcon-hero.webp",
  insertable: true,
  defaultProps: {
    title: "Launch campaigns faster",
    description: "Add an approved feature grid, edit the copy, and keep the layout on brand.",
    columns: "3"
  },
  defaultChildren: "<p class=\"text-sm text-slate-300\">Optional supporting content.</p>",
  fields: {
    title: {
      type: "text",
      label: "Headline",
      group: "Content",
      required: true,
      maxLength: 90
    },
    description: {
      type: "textarea",
      label: "Intro copy",
      group: "Content",
      required: true,
      maxLength: 180
    },
    columns: {
      type: "choice",
      label: "Columns",
      group: "Layout",
      options: [
        { value: "1", label: "One" },
        { value: "2", label: "Two" },
        { value: "3", label: "Three" }
      ]
    }
  }
};
