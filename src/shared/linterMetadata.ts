export interface LinterLink {
  label: string;
  href: string;
}

export interface LinterDescriptorMetadata {
  descriptorId?: string;
  name?: string;
  linterName?: string;
  configFileName?: string;
  url?: string;
  repo?: string;
  rulesConfigurationUrl?: string;
  imageUrl?: string;
  bannerImageUrl?: string;
  text?: string;
  urls?: LinterLink[];
}
