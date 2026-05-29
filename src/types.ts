export interface Link {
  id: string;
  url: string;
  title: string;
  description: string;
  tags: string[];
  created_at: string;
  updated_at?: string;
  star?: string;
}

export interface LinkAnalysis {
  title: string;
  description: string;
  tags: string[];
}
