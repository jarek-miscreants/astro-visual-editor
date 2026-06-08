export default {
  label: "Landing CTA",
  category: "Sections",
  description: "A simple campaign call-to-action section with safe tone variants.",
  thumbnail: "/images/zafcon-hero.webp",
  insertable: true,
  defaultProps: {
    headline: "Ready to launch this campaign?",
    description: "Give visitors one clear action and keep the section safely on brand.",
    buttonLabel: "Talk to us",
    buttonHref: "/about",
    tone: "blue"
  },
  fields: {
    headline: {
      type: "text",
      label: "Headline",
      group: "Content",
      required: true,
      maxLength: 90
    },
    description: {
      type: "textarea",
      label: "Description",
      group: "Content",
      required: true,
      maxLength: 180
    },
    buttonLabel: {
      type: "text",
      label: "Button label",
      group: "CTA",
      required: true
    },
    buttonHref: {
      type: "link",
      label: "Button link",
      group: "CTA",
      required: true
    },
    tone: {
      type: "choice",
      label: "Tone",
      group: "Design",
      options: [
        { value: "blue", label: "Blue" },
        { value: "dark", label: "Dark" },
        { value: "light", label: "Light" }
      ]
    }
  }
};
