#!/bin/bash

# Set output file
output_file="merged_modules.txt"

# Remove output file if it exists
rm -f "$output_file"

# Function to print folder structure
print_structure() {
    echo -e "\nFolder Structure:" > "$output_file"
    tree modules >> "$output_file"
    echo -e "\n\n=== Begin File Contents ===\n\n" >> "$output_file"
}

# Print the folder structure first
print_structure

# Process files folder by folder
for folder in $(find modules -type d | sort); do
    # Add folder name if it contains files
    if [ -n "$(ls -A $folder/*.js 2>/dev/null)" ]; then
        echo -e "\n\n=== Folder: $folder ===\n" >> "$output_file"
        
        # Process each .js file in the folder
        for file in $folder/*.js; do
            if [ -f "$file" ]; then
                echo -e "\n--- File: $file ---\n" >> "$output_file"
                cat "$file" >> "$output_file"
                echo -e "\n--- End of $file ---\n" >> "$output_file"
            fi
        done
    fi
done

echo "Files have been merged into $output_file"