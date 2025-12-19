
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://zlsvxefbviirqetewiod.supabase.co';
const supabaseKey = 'sb_publishable_LEpNdnIkoVmnBmQKCSmDVg_BPviDoX2';

export const supabase = createClient(supabaseUrl, supabaseKey);
