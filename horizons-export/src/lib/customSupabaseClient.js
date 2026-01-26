import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://tjagxmusbnbipeeitsyi.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqYWd4bXVzYm5iaXBlZWl0c3lpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0MTQ5NDcsImV4cCI6MjA3NDk5MDk0N30.R87_hND6jA127PZ-SP0dSGPMWhkbfcyw9ndhWAkVbdk';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);